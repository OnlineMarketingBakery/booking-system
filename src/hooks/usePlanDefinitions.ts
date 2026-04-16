import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PlanDefinitionRow = Database["public"]["Tables"]["plan_definitions"]["Row"];

export function usePlanDefinitions() {
  return useQuery({
    queryKey: ["plan-definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_definitions")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlanDefinitionRow[];
    },
    staleTime: 60_000,
  });
}
