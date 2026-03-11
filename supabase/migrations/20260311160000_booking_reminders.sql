-- Org-level default: send email reminder day before / 1 hour before (can be overridden per customer)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS reminder_email_day_before BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_email_hour_before BOOLEAN NOT NULL DEFAULT true;

-- Track which reminders we've already sent so we don't send twice
CREATE TABLE IF NOT EXISTS public.booking_reminder_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('day_before', 'hour_before')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_booking_reminder_sent_booking ON public.booking_reminder_sent(booking_id);

ALTER TABLE public.booking_reminder_sent ENABLE ROW LEVEL SECURITY;
-- Only service role (bypasses RLS) should write; block anon/auth from reading/writing
CREATE POLICY "No direct access to booking_reminder_sent"
  ON public.booking_reminder_sent FOR ALL
  USING (false)
  WITH CHECK (false);

-- Per-customer reminder preferences (optional override; if missing, use org default)
CREATE TABLE IF NOT EXISTS public.customer_reminder_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  email_reminder_day_before BOOLEAN NOT NULL DEFAULT true,
  email_reminder_hour_before BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, customer_email)
);

CREATE INDEX IF NOT EXISTS idx_customer_reminder_prefs_org ON public.customer_reminder_preferences(organization_id);

ALTER TABLE public.customer_reminder_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage customer_reminder_preferences"
  ON public.customer_reminder_preferences FOR ALL
  USING (organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid()));
CREATE POLICY "Service role can read customer_reminder_preferences"
  ON public.customer_reminder_preferences FOR SELECT
  USING (true);

CREATE TRIGGER update_customer_reminder_preferences_updated_at
  BEFORE UPDATE ON public.customer_reminder_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
