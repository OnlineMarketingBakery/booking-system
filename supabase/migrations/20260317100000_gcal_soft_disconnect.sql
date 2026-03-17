-- Soft disconnect: keep token so we can still delete events from GCal when admin deletes a booking.
-- "Connected" in the app = token exists AND disconnected_at IS NULL.
ALTER TABLE google_calendar_tokens
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN google_calendar_tokens.disconnected_at IS 'When set, GCal is considered disconnected (no sync/fetch) but token is kept for cleanup (e.g. delete event when booking is deleted).';
