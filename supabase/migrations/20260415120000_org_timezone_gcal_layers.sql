-- Org timezone (IANA) for display and Google Calendar event times
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Amsterdam';

COMMENT ON COLUMN public.organizations.timezone IS 'IANA timezone for salon scheduling and Google Calendar (e.g. Europe/Amsterdam).';

-- Optional: sync each staff booking to a dedicated Google secondary calendar (Salonora - Name)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS gcal_use_staff_secondary_calendars boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.gcal_use_staff_secondary_calendars IS
  'When true and staff.gcal_secondary_calendar_id is set, booking events sync to that calendar; otherwise owner primary.';

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS gcal_secondary_calendar_id text;

COMMENT ON COLUMN public.staff.gcal_secondary_calendar_id IS
  'Google Calendar ID for Salonora - StaffName layer; events for this assignee go here when org flag is on.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gcal_calendar_id text;

COMMENT ON COLUMN public.bookings.gcal_calendar_id IS
  'Google calendar id where gcal_event_id lives (null = primary).';

-- Public org view: expose timezone for embed / booking widget
DROP VIEW IF EXISTS public.organizations_public;
CREATE VIEW public.organizations_public AS
  SELECT id, name, slug, logo_url, embed_theme, holiday_region, owner_default_staff_id, timezone
  FROM public.organizations;

GRANT SELECT ON public.organizations_public TO anon, authenticated;
