-- Location opening hours (replaces per-staff availability for booking flow)
CREATE TABLE public.location_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_availability_location ON public.location_availability(location_id);

ALTER TABLE public.location_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org owners can manage location_availability"
  ON public.location_availability FOR ALL
  USING (
    location_id IN (
      SELECT id FROM public.locations
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "Public can view location_availability"
  ON public.location_availability FOR SELECT
  USING (true);
