-- Store Google Calendar event ID on bookings so we can skip re-syncing and avoid duplicates when reconnecting
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gcal_event_id text;

COMMENT ON COLUMN public.bookings.gcal_event_id IS 'Google Calendar event ID after syncing; null if not yet synced or Google not connected.';
