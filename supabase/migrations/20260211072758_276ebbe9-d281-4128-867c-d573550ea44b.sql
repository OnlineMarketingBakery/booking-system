-- Add a column to store the Stripe checkout session ID
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS stripe_session_id text;
COMMENT ON COLUMN public.bookings.stripe_session_id IS 'Stripe Checkout Session ID for payment verification';