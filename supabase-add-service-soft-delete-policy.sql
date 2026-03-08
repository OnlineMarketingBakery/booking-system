-- Run this in Supabase SQL Editor once, so that when a service is "deleted" (is_active = false),
-- existing bookings can still show the service name (e.g. on thank-you page, dashboard).
-- Policy: allow reading a service if it is referenced by any booking.
CREATE POLICY "Anyone can view services that have bookings"
  ON public.services FOR SELECT
  USING (id IN (SELECT service_id FROM public.bookings));
