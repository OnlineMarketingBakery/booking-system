import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Deletes all rows scoped to an organization (bookings, staff, services, locations, etc.).
 * Does not delete the organization row itself — callers use this before UPDATE or DELETE on organizations.
 */
export async function deleteOrganizationScopedData(
  admin: SupabaseClient,
  organizationId: string,
): Promise<void> {
  await admin.from("organizations").update({ owner_default_staff_id: null }).eq("id", organizationId);

  await admin.from("bookings").delete().eq("organization_id", organizationId);
  await admin.from("pending_booking_confirmations").delete().eq("organization_id", organizationId);
  await admin.from("confirmed_booking_customers").delete().eq("organization_id", organizationId);
  await admin.from("customer_reminder_preferences").delete().eq("organization_id", organizationId);
  await admin.from("organization_break_slots").delete().eq("organization_id", organizationId);
  await admin.from("location_closure_slots").delete().eq("organization_id", organizationId);
  await admin.from("organization_off_days").delete().eq("organization_id", organizationId);
  await admin.from("organization_holiday_overrides").delete().eq("organization_id", organizationId);

  const { data: staffIds } = await admin.from("staff").select("id").eq("organization_id", organizationId);
  const ids = (staffIds ?? []).map((r) => r.id as string);
  if (ids.length > 0) {
    await admin.from("availability").delete().in("staff_id", ids);
    await admin.from("staff_locations").delete().in("staff_id", ids);
  }
  await admin.from("staff_invitations").delete().eq("organization_id", organizationId);
  await admin.from("staff").delete().eq("organization_id", organizationId);
  await admin.from("services").delete().eq("organization_id", organizationId);
  await admin.from("locations").delete().eq("organization_id", organizationId);
  await admin.from("vat_rates").delete().eq("organization_id", organizationId);
}
