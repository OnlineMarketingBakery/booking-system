import type { SupabaseClient } from "@supabase/supabase-js";

export type OrganizationStaffPick = {
  id: string;
  owner_default_staff_id?: string | null;
};

/**
 * Next default assignee: oldest active non-placeholder staff (excluding removed id), else owner placeholder row.
 */
export async function pickReplacementDefaultStaff(
  supabase: SupabaseClient,
  organizationId: string,
  excludeStaffId: string,
): Promise<string | null> {
  const { data: reals, error: rErr } = await supabase
    .from("staff")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("is_owner_placeholder", false)
    .neq("id", excludeStaffId)
    .order("created_at", { ascending: true });
  if (rErr) throw rErr;
  if (reals?.length) return reals[0].id as string;

  const { data: ph, error: pErr } = await supabase
    .from("staff")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("is_owner_placeholder", true)
    .maybeSingle();
  if (pErr) throw pErr;
  return (ph?.id as string | undefined) ?? null;
}

/** Reassign org default + bookings off this staff, then deactivate the staff row. */
export async function reassignBookingsAndOrgDefaultThenDeactivate(
  supabase: SupabaseClient,
  organization: OrganizationStaffPick,
  staffId: string,
): Promise<void> {
  const replacement = await pickReplacementDefaultStaff(supabase, organization.id, staffId);

  if (String(organization.owner_default_staff_id ?? "") === staffId) {
    const { error: orgErr } = await supabase
      .from("organizations")
      .update({ owner_default_staff_id: replacement })
      .eq("id", organization.id);
    if (orgErr) throw orgErr;
  }

  if (replacement) {
    const { error: bErr } = await supabase
      .from("bookings")
      .update({ staff_id: replacement })
      .eq("staff_id", staffId)
      .eq("organization_id", organization.id);
    if (bErr) throw bErr;
  } else {
    const { error: bErr } = await supabase
      .from("bookings")
      .update({ staff_id: null })
      .eq("staff_id", staffId)
      .eq("organization_id", organization.id);
    if (bErr) throw bErr;
  }

  const { error } = await supabase
    .from("staff")
    .update({ is_active: false })
    .eq("id", staffId)
    .eq("organization_id", organization.id);
  if (error) throw error;
}
