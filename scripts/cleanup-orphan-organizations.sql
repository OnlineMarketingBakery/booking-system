-- =============================================================================
-- Cleanup: organizations whose owner_id no longer exists in app_users
-- =============================================================================
-- Run in Supabase SQL Editor as a role that bypasses RLS (e.g. postgres).
--
-- Why a plain DELETE FROM organizations ... fails:
--   Child tables (staff, services, bookings, …) still reference the org.
--   This script mirrors the order used in deleteOrganizationScopedData (Edge).
--
-- STEP 1 — Preview only (run this first; no changes):
-- =============================================================================

SELECT o.id, o.name, o.slug, o.owner_id, o.created_at
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = o.owner_id)
ORDER BY o.created_at;

-- =============================================================================
-- STEP 2 — Delete orphan orgs and all scoped data (transaction)
-- Uncomment BEGIN … COMMIT when you are satisfied with the preview above.
-- =============================================================================

/*
BEGIN;

CREATE TEMP TABLE _orphan_org_ids ON COMMIT DROP AS
SELECT o.id AS org_id
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = o.owner_id);

UPDATE public.organizations
SET owner_default_staff_id = NULL
WHERE id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.bookings
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.pending_booking_confirmations
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.confirmed_booking_customers
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.customer_reminder_preferences
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.organization_break_slots
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.location_closure_slots
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.organization_off_days
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.organization_holiday_overrides
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.availability
WHERE staff_id IN (
  SELECT s.id FROM public.staff s
  WHERE s.organization_id IN (SELECT org_id FROM _orphan_org_ids)
);

DELETE FROM public.staff_locations
WHERE staff_id IN (
  SELECT s.id FROM public.staff s
  WHERE s.organization_id IN (SELECT org_id FROM _orphan_org_ids)
);

DELETE FROM public.staff_invitations
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.staff
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.services
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.locations
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.vat_rates
WHERE organization_id IN (SELECT org_id FROM _orphan_org_ids);

DELETE FROM public.organizations
WHERE id IN (SELECT org_id FROM _orphan_org_ids);

COMMIT;
*/

-- To dry-run the destructive block: change COMMIT to ROLLBACK at the end.
