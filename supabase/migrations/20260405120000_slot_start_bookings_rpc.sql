-- Simpler public-booking capacity: each row here is one booking's chosen start (first segment only
-- overlaps customer slot times). Slot is full when count(start_time = slot) >= eligible staff count.

DROP FUNCTION IF EXISTS public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.get_location_slot_start_bookings(
  p_location_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_exclude_pending_token text DEFAULT NULL
)
RETURNS TABLE (start_time timestamptz, staff_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT b.start_time, b.staff_id
  FROM public.bookings b
  WHERE b.location_id = p_location_id
    AND b.status <> 'cancelled'::public.booking_status
    AND b.start_time >= p_range_start
    AND b.start_time < p_range_end

  UNION ALL

  SELECT
    (p.payload->>'start_time')::timestamptz AS st,
    CASE
      WHEN (p.payload->>'staff_id') IS NOT NULL
        AND (p.payload->>'staff_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p.payload->>'staff_id')::uuid
      ELSE NULL
    END
  FROM public.pending_booking_confirmations p
  WHERE p.used_at IS NULL
    AND p.released_at IS NULL
    AND p.expires_at > now()
    AND (p.payload->>'location_id') IS NOT NULL
    AND (p.payload->>'location_id')::uuid = p_location_id
    AND (p_exclude_pending_token IS NULL OR p.token <> p_exclude_pending_token)
    AND (p.payload->>'start_time')::timestamptz >= p_range_start
    AND (p.payload->>'start_time')::timestamptz < p_range_end;
$$;

COMMENT ON FUNCTION public.get_location_slot_start_bookings(uuid, timestamptz, timestamptz, text) IS
  'Rows per booking/pending hold whose start_time falls in range; same start_time = same customer-facing slot.';

REVOKE ALL ON FUNCTION public.get_location_slot_start_bookings(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_slot_start_bookings(uuid, timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;
