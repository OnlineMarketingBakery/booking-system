-- Run this in Supabase SQL Editor once, so that when a staff member is "deleted" (is_active = false),
-- existing bookings can still show the staff name (e.g. on thank-you page, dashboard).
-- Policy: allow reading a staff row if it is referenced by any booking.
CREATE POLICY "Anyone can view staff that have bookings"
  ON public.staff FOR SELECT
  USING (id IN (SELECT staff_id FROM public.bookings));
