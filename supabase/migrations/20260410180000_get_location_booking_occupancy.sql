-- Interval-based occupancy for public booking (replaces start-time-only matching).
-- Returns each booking and pending hold as [start_time, end_time) wall span with staff_id for overlap checks.

CREATE OR REPLACE FUNCTION public.get_location_booking_occupancy(
  p_location_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_exclude_pending_token text DEFAULT NULL
)
RETURNS TABLE (start_time timestamptz, end_time timestamptz, staff_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT b.start_time, b.end_time, b.staff_id
  FROM public.bookings b
  WHERE b.location_id = p_location_id
    AND b.status NOT IN ('cancelled'::public.booking_status, 'no_show'::public.booking_status)
    AND b.start_time < p_range_end
    AND b.end_time > p_range_start

  UNION ALL

  SELECT pi.st, pi.en, pi.sid
  FROM (
    SELECT
      (p.payload->>'start_time')::timestamptz AS st,
      (p.payload->>'start_time')::timestamptz
        + (
            COALESCE(
              (
                SELECT SUM(s.duration_minutes)::integer
                FROM jsonb_array_elements_text(
                  COALESCE(p.payload->'service_ids', '[]'::jsonb)
                ) AS elem(service_id)
                INNER JOIN public.services s ON s.id = elem.service_id::uuid
              ),
              30
            )
          ) * interval '1 minute' AS en,
      CASE
        WHEN (p.payload->>'staff_id') IS NOT NULL
          AND (p.payload->>'staff_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (p.payload->>'staff_id')::uuid
        ELSE NULL::uuid
      END AS sid
    FROM public.pending_booking_confirmations p
    WHERE p.used_at IS NULL
      AND p.released_at IS NULL
      AND p.expires_at > now()
      AND (p.payload->>'location_id') IS NOT NULL
      AND (p.payload->>'location_id')::uuid = p_location_id
      AND (p_exclude_pending_token IS NULL OR p.token <> p_exclude_pending_token)
  ) pi
  WHERE pi.st < p_range_end
    AND pi.en > p_range_start;
$$;

COMMENT ON FUNCTION public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text) IS
  'Booking + pending-hold wall intervals with staff_id; use half-open overlap vs candidate [start, end).';

REVOKE ALL ON FUNCTION public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;
