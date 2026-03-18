-- Exact date/time shown when the customer chose the slot (for emails — no UTC conversion).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_slot_date date NULL,
  ADD COLUMN IF NOT EXISTS customer_slot_time text NULL;

COMMENT ON COLUMN public.bookings.customer_slot_date IS 'Calendar date as on booking UI (YYYY-MM-DD)';
COMMENT ON COLUMN public.bookings.customer_slot_time IS 'Start time as on booking UI (HH:mm, 24h)';
