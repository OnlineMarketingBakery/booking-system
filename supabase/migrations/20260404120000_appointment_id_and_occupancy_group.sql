-- One logical appointment can span multiple booking rows (multi-service). Capacity must count
-- appointments, not segments. appointment_id ties segments together; RPC exposes capacity_group_id.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS appointment_id uuid NULL;

COMMENT ON COLUMN public.bookings.appointment_id IS
  'Same UUID for all segments of one checkout; used for parallel-slot capacity counting.';

DROP FUNCTION IF EXISTS public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.get_location_booking_occupancy(
  p_location_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_exclude_pending_token text DEFAULT NULL
)
RETURNS TABLE (
  start_time timestamptz,
  end_time timestamptz,
  staff_id uuid,
  capacity_group_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    b.start_time,
    b.end_time,
    b.staff_id,
    COALESCE(b.appointment_id::text, b.id::text) AS capacity_group_id
  FROM public.bookings b
  WHERE b.location_id = p_location_id
    AND b.status <> 'cancelled'::public.booking_status
    AND b.start_time < p_range_end
    AND b.end_time > p_range_start

  UNION ALL

  SELECT
    pi.st,
    pi.en,
    pi.sid,
    pi.gid
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
      END AS sid,
      ('pending:' || p.token) AS gid
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
  'Occupancy segments with capacity_group_id: merge rows sharing the same group before counting parallel bookings.';

REVOKE ALL ON FUNCTION public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_booking_occupancy(uuid, timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;
