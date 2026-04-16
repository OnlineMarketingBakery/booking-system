import type { Database } from "@/integrations/supabase/types";

export type OrgTier = Database["public"]["Enums"]["org_tier"];

export type PlanDefinitionLike = Pick<
  Database["public"]["Tables"]["plan_definitions"]["Row"],
  "tier" | "max_locations" | "display_name"
>;

/** Fallback when plan_definitions is missing a row or the query failed */
export const TIER_LIMITS: Record<OrgTier, number> = {
  tier_1: 1,
  tier_2: 10,
  tier_3: 100,
};

export const TIER_LABELS: Record<OrgTier, string> = {
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
};

export function maxLocationsForTier(
  tier: OrgTier | string | null | undefined,
  definitions?: PlanDefinitionLike[] | null
): number {
  const key = (tier || "tier_1") as OrgTier;
  if (definitions?.length) {
    const row = definitions.find((d) => d.tier === key);
    if (row) return Math.min(Math.max(1, row.max_locations), 10_000);
  }
  return TIER_LIMITS[key] ?? TIER_LIMITS.tier_1;
}

export function displayNameForTier(
  tier: OrgTier | string | null | undefined,
  definitions?: PlanDefinitionLike[] | null
): string {
  const key = (tier || "tier_1") as OrgTier;
  const row = definitions?.find((d) => d.tier === key);
  if (row?.display_name?.trim()) return row.display_name.trim();
  return TIER_LABELS[key] ?? key;
}

export function tierLabelWithLimit(
  t: OrgTier,
  definitions?: PlanDefinitionLike[] | null
): string {
  const name = displayNameForTier(t, definitions);
  const limit = maxLocationsForTier(t, definitions);
  const loc = limit === 1 ? "1 location" : `${limit} locations`;
  return `${name} (${loc})`;
}
