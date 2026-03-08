import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useOrganization() {
  const { user, hasRole, refreshRoles } = useAuth();

  const { data: organization, isLoading } = useQuery({
    queryKey: ["organization", user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Super admin must not have their own salon (platform admin only)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const isSuperAdmin = roles?.some((r) => r.role === "super_admin") ?? false;
      if (isSuperAdmin) return null;

      // Owner: fetch org directly
      const { data: ownedOrg } = await supabase
        .from("organizations")
        .select("*")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (ownedOrg) return ownedOrg;

      // Staff: find org via staff record
      const { data: staffRecord } = await supabase
        .from("staff")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (staffRecord) {
        const { data: staffOrg } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", staffRecord.organization_id)
          .maybeSingle();
        return staffOrg;
      }

      return null;
    },
    enabled: !!user,
  });

  const queryClient = useQueryClient();

  const createOrganization = useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      if (!user) throw new Error("Not authenticated");
      if (hasRole("super_admin")) throw new Error("Super admins cannot create a salon. Use the Admin Panel to add salon owners.");

      const { data, error } = await supabase.rpc("create_organization_with_role", {
        _name: name,
        _slug: slug,
        _owner_id: user.id,
      });
      if (error) throw error;

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", data)
        .single();
      if (orgError) throw orgError;

      return org;
    },
    onSuccess: async () => {
      await refreshRoles();
      queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });

  return { organization, isLoading, createOrganization };
}
