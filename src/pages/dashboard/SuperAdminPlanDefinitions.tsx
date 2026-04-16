import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlanDefinitions, type PlanDefinitionRow } from "@/hooks/usePlanDefinitions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Save, ChevronDown, MapPin, Sparkles } from "lucide-react";
import type { OrgTier } from "@/lib/tierLimits";
import type { Json } from "@/integrations/supabase/types";

const KNOWN_FEATURES = [
  {
    key: "booking_widget" as const,
    title: "Booking widget",
    hint: "Salon can embed booking on their website.",
  },
  {
    key: "public_booking" as const,
    title: "Public booking",
    hint: "Highlights the public booking experience for owners.",
  },
  {
    key: "multi_location" as const,
    title: "Multiple locations",
    hint: "Shown when comparing plans (growth / chains).",
  },
];

type KnownFeatureKey = (typeof KNOWN_FEATURES)[number]["key"];

type FeatureFlags = Record<KnownFeatureKey, boolean>;

function readFlagsFromRow(features: PlanDefinitionRow["features"]): FeatureFlags {
  const p =
    features && typeof features === "object" && !Array.isArray(features)
      ? (features as Record<string, unknown>)
      : {};
  return {
    booking_widget: Boolean(p.booking_widget),
    public_booking: Boolean(p.public_booking),
    multi_location: Boolean(p.multi_location),
  };
}

function mergeFeaturesForSave(
  existing: PlanDefinitionRow["features"],
  flags: FeatureFlags
): Json {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const k of KNOWN_FEATURES) {
    base[k.key] = flags[k.key];
  }
  return base as Json;
}

const tierAccent: Record<string, string> = {
  tier_1: "from-violet-500/80 to-violet-500/10",
  tier_2: "from-emerald-500/80 to-emerald-500/10",
  tier_3: "from-amber-500/80 to-amber-500/10",
};

function PlanDefinitionEditor({ row }: { row: PlanDefinitionRow }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(row.display_name);
  const [maxLocations, setMaxLocations] = useState(String(row.max_locations));
  const [description, setDescription] = useState(row.description ?? "");
  const [flags, setFlags] = useState<FeatureFlags>(() => readFlagsFromRow(row.features));
  const [sortOrder, setSortOrder] = useState(String(row.sort_order));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setDisplayName(row.display_name);
    setMaxLocations(String(row.max_locations));
    setDescription(row.description ?? "");
    setFlags(readFlagsFromRow(row.features));
    setSortOrder(String(row.sort_order));
  }, [
    row.tier,
    row.updated_at,
    row.display_name,
    row.max_locations,
    row.description,
    row.features,
    row.sort_order,
  ]);

  const save = useMutation({
    mutationFn: async () => {
      const max = Number.parseInt(maxLocations, 10);
      if (!Number.isFinite(max) || max < 1 || max > 10_000) {
        throw new Error("Location limit must be a whole number between 1 and 10,000.");
      }
      const order = Number.parseInt(sortOrder, 10);
      if (!Number.isFinite(order)) {
        throw new Error("Display order must be a number.");
      }
      const name = displayName.trim();
      if (!name) throw new Error("Please enter a plan name.");

      const { error } = await supabase
        .from("plan_definitions")
        .update({
          display_name: name,
          max_locations: max,
          description: description.trim() || null,
          features: mergeFeaturesForSave(row.features, flags),
          sort_order: order,
        })
        .eq("tier", row.tier);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan-definitions"] });
      toast({
        title: "Saved",
        description: `“${displayName.trim()}” is updated for all salons on this tier.`,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const accent = tierAccent[row.tier] ?? "from-primary/70 to-primary/10";
  const titlePreview = displayName.trim() || row.display_name;

  return (
    <Card className="relative flex flex-col overflow-hidden border-border/80 shadow-sm transition-shadow hover:shadow-md">
      <div className={cn("h-1.5 w-full bg-gradient-to-r", accent)} aria-hidden />
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-xl font-semibold tracking-tight truncate">{titlePreview}</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              What salon owners see for this subscription level, and how many active locations they may have.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0 font-normal text-muted-foreground">
            {row.tier.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5 pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`pd-name-${row.tier}`} className="text-foreground">
              Plan name
            </Label>
            <Input
              id={`pd-name-${row.tier}`}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Starter"
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`pd-max-${row.tier}`} className="inline-flex items-center gap-1.5 text-foreground">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              Max active locations
            </Label>
            <Input
              id={`pd-max-${row.tier}`}
              type="number"
              min={1}
              max={10_000}
              value={maxLocations}
              onChange={(e) => setMaxLocations(e.target.value)}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">Salons cannot add more active locations than this number.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`pd-desc-${row.tier}`} className="text-foreground">
            Short description
          </Label>
          <Textarea
            id={`pd-desc-${row.tier}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="One or two sentences for the Plan & limits page."
            className="min-h-[80px] resize-y"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Included for this plan
          </div>
          <p className="text-xs text-muted-foreground -mt-1">These control checklist items when salons compare plans.</p>
          <div className="space-y-2">
            {KNOWN_FEATURES.map(({ key, title, hint }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/25 px-3 py-3 sm:px-4"
              >
                <div className="min-w-0 space-y-0.5 pr-2">
                  <p className="text-sm font-medium leading-none">{title}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{hint}</p>
                </div>
                <Switch
                  id={`pd-flag-${row.tier}-${key}`}
                  checked={flags[key]}
                  onCheckedChange={(checked) => setFlags((f) => ({ ...f, [key]: checked }))}
                  className="shrink-0"
                  aria-label={title}
                />
              </div>
            ))}
          </div>
        </div>

        <Separator className="opacity-60" />

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ml-2 h-9 gap-1.5 px-2 text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="space-y-2 max-w-[200px]">
              <Label htmlFor={`pd-sort-${row.tier}`}>Compare order</Label>
              <Input
                id={`pd-sort-${row.tier}`}
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">Lower numbers appear first when plans are listed.</p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="mt-auto pt-1">
          <Button type="button" className="w-full sm:w-auto min-w-[160px]" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SuperAdminPlanDefinitions() {
  const { data: rows = [], isLoading, isError, error } = usePlanDefinitions();

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/50 max-w-lg">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Could not load plans</CardTitle>
          <CardDescription>{error instanceof Error ? error.message : "Request failed"}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">No plans configured</CardTitle>
          <CardDescription>Apply the latest database migration so plan definitions exist.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight">Plans & limits</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Set the name, location cap, and marketing copy for each subscription tier. Salon owners see this on{" "}
          <span className="text-foreground/90 font-medium">Settings → Plan & limits</span>; tier names here also appear
          when you assign a tier to a salon.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <PlanDefinitionEditor key={row.tier as OrgTier} row={row} />
        ))}
      </div>
    </div>
  );
}
