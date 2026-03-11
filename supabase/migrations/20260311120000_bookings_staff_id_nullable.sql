-- Allow bookings without an assigned staff member (e.g. when location has no staff yet)
ALTER TABLE public.bookings
  ALTER COLUMN staff_id DROP NOT NULL;

-- Unique index was (staff_id, start_time) — allow multiple unassigned bookings at same time
-- So we only enforce uniqueness when staff_id is set
DROP INDEX IF EXISTS idx_no_double_booking;
CREATE UNIQUE INDEX idx_no_double_booking ON public.bookings (staff_id, start_time)
  WHERE status NOT IN ('cancelled') AND staff_id IS NOT NULL;
