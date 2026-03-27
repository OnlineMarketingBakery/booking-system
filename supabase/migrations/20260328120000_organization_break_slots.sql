-- Staff / salon break windows: recurring (every day) or one-off date, per location.
-- Whole salon or specific staff at that location. Used to hide slots on the public booking page.

CREATE TABLE public.organization_break_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  applies_date DATE NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  applies_whole_salon BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_break_slots_recurring_date_check CHECK (
    (is_recurring = true AND applies_date IS NULL)
    OR (is_recurring = false AND applies_date IS NOT NULL)
  )
);

CREATE TABLE public.organization_break_slot_staff (
  break_slot_id UUID NOT NULL REFERENCES public.organization_break_slots(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  PRIMARY KEY (break_slot_id, staff_id)
);

CREATE INDEX idx_organization_break_slots_org_location
  ON public.organization_break_slots(organization_id, location_id);

CREATE INDEX idx_organization_break_slots_date
  ON public.organization_break_slots(organization_id, applies_date)
  WHERE applies_date IS NOT NULL;

COMMENT ON TABLE public.organization_break_slots IS 'Break/lunch windows: blocks booking slots for a whole salon or selected staff at one location, either every day (recurring) or on a specific date.';
COMMENT ON TABLE public.organization_break_slot_staff IS 'When applies_whole_salon is false, staff members at the location who are on break during the window.';

ALTER TABLE public.organization_break_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_break_slot_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read organization_break_slots"
  ON public.organization_break_slots FOR SELECT USING (true);

CREATE POLICY "Org members manage organization_break_slots"
  ON public.organization_break_slots FOR ALL USING (
    organization_id IN (SELECT get_user_organization_ids(auth.uid()))
  );

CREATE POLICY "Public read organization_break_slot_staff"
  ON public.organization_break_slot_staff FOR SELECT USING (true);

CREATE POLICY "Org members manage organization_break_slot_staff"
  ON public.organization_break_slot_staff FOR ALL USING (
    break_slot_id IN (
      SELECT id FROM public.organization_break_slots
      WHERE organization_id IN (SELECT get_user_organization_ids(auth.uid()))
    )
  );
