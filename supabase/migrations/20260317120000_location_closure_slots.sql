-- Date-specific closure windows: salon closed for specific hours on a given date (e.g. 12:00–14:00).
-- Multiple rows per date allowed. location_id NULL = applies to all locations.
CREATE TABLE public.location_closure_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_closure_slots_org_date
  ON public.location_closure_slots(organization_id, date);
CREATE INDEX idx_location_closure_slots_location_date
  ON public.location_closure_slots(location_id, date) WHERE location_id IS NOT NULL;

COMMENT ON TABLE public.location_closure_slots IS 'Specific time windows when a location (or all locations) is closed on a given date. Used to block slots in the booking flow.';

ALTER TABLE public.location_closure_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read location_closure_slots"
  ON public.location_closure_slots FOR SELECT USING (true);

CREATE POLICY "Org members manage location_closure_slots"
  ON public.location_closure_slots FOR ALL USING (
    organization_id IN (SELECT get_user_organization_ids(auth.uid()))
  );
