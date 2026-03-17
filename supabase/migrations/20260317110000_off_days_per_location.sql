-- Allow custom off days to apply to a specific location or all locations (null = all).
ALTER TABLE public.organization_off_days
  ADD COLUMN IF NOT EXISTS location_id uuid NULL REFERENCES public.locations(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.organization_off_days.location_id IS 'When null, this off day applies to all locations. When set, only this location is closed.';

-- Replace unique constraint: one row per (org, date) for org-wide, one per (org, date, location) per location.
ALTER TABLE public.organization_off_days
  DROP CONSTRAINT IF EXISTS organization_off_days_organization_id_date_key;

-- PostgreSQL treats NULL as distinct in unique constraints, so (org_id, date, NULL) can appear once.
ALTER TABLE public.organization_off_days
  ADD CONSTRAINT organization_off_days_organization_id_date_location_id_key
  UNIQUE (organization_id, date, location_id);

CREATE INDEX IF NOT EXISTS idx_org_off_days_location
  ON public.organization_off_days(organization_id, location_id, date);
