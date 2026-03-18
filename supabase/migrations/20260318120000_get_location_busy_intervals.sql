-- Public booking page needs to hide times already taken at a location (any staff).
-- RLS blocks anon from reading bookings; this RPC only returns start/end (no PII).
CREATE OR REPLACE FUNCTION public.get_location_busy_intervals(
  p_location_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz
)
RETURNS TABLE (start_time timestamptz, end_time timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT b.start_time, b.end_time
  FROM public.bookings b
  WHERE b.location_id = p_location_id
    AND b.status <> 'cancelled'::public.booking_status
    AND b.start_time < p_range_end
    AND b.end_time > p_range_start;
$$;

COMMENT ON FUNCTION public.get_location_busy_intervals(uuid, timestamptz, timestamptz) IS
  'Returns busy intervals at a location for slot availability (public booking widget).';

REVOKE ALL ON FUNCTION public.get_location_busy_intervals(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_busy_intervals(uuid, timestamptz, timestamptz) TO anon, authenticated, service_role;
