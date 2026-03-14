-- Optional reason for custom off days (e.g. "Staff meeting", "Holiday closure")
ALTER TABLE public.organization_off_days
  ADD COLUMN IF NOT EXISTS reason text DEFAULT NULL;

COMMENT ON COLUMN public.organization_off_days.reason IS 'Optional reason shown to customers when they hover over this off day in the booking calendar.';
