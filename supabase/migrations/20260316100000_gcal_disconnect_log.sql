-- Store when user disconnected Google Calendar so we only re-sync bookings created after that time
CREATE TABLE IF NOT EXISTS public.gcal_disconnect_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  disconnected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcal_disconnect_log_user ON public.gcal_disconnect_log(user_id);

ALTER TABLE public.gcal_disconnect_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own disconnect log"
  ON public.gcal_disconnect_log FOR SELECT
  USING (auth.uid() = user_id);

-- Service role needs to insert (on disconnect) and read (in sync/backfill)
CREATE POLICY "Service role full access gcal_disconnect_log"
  ON public.gcal_disconnect_log FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE public.gcal_disconnect_log IS 'Tracks when user disconnected Google Calendar; used to avoid re-syncing transferred events on reconnect.';
