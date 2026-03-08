-- Run this in Supabase SQL Editor once, so that when a location is "deleted" (is_active = false),
-- existing bookings can still show the location name (e.g. on thank-you page, dashboard).
-- Policy: allow reading a location row if it is referenced by any booking.
CREATE POLICY "Anyone can view locations that have bookings"
  ON public.locations FOR SELECT
  USING (id IN (SELECT location_id FROM public.bookings));
