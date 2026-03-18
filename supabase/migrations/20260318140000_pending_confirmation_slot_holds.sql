-- Hold time slots while a customer is in email confirmation flow.
ALTER TABLE public.pending_booking_confirmations
  ADD COLUMN IF NOT EXISTS released_at timestamptz NULL;

COMMENT ON COLUMN public.pending_booking_confirmations.released_at IS
  'When set, customer cancelled the hold via link; slot is free again before expiry.';

DROP FUNCTION IF EXISTS public.get_location_busy_intervals(uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_location_busy_intervals(
  p_location_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_exclude_pending_token text DEFAULT NULL
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
    AND b.end_time > p_range_start

  UNION ALL

  SELECT pi.st, pi.en
  FROM (
    SELECT
      p.token,
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
          ) * interval '1 minute' AS en
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

COMMENT ON FUNCTION public.get_location_busy_intervals(uuid, timestamptz, timestamptz, text) IS
  'Busy intervals: confirmed bookings + active pending email holds. Exclude token when confirming own hold.';

REVOKE ALL ON FUNCTION public.get_location_busy_intervals(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_location_busy_intervals(uuid, timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;
