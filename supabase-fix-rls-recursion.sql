-- Fix: "infinite recursion detected in policy for relation bookings"
-- The "have bookings" policies on locations/services/staff query the bookings table,
-- which can trigger RLS on bookings and cause recursion. Use SECURITY DEFINER
-- functions so the check runs without triggering RLS on bookings.

-- 1. Create helper functions (bypass RLS when reading bookings)
CREATE OR REPLACE FUNCTION public.get_location_ids_with_bookings()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT DISTINCT location_id FROM public.bookings $$;

CREATE OR REPLACE FUNCTION public.get_service_ids_with_bookings()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT DISTINCT service_id FROM public.bookings $$;

CREATE OR REPLACE FUNCTION public.get_staff_ids_with_bookings()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT DISTINCT staff_id FROM public.bookings $$;

-- 2. Drop the old policies that use subqueries on bookings
DROP POLICY IF EXISTS "Anyone can view locations that have bookings" ON public.locations;
DROP POLICY IF EXISTS "Anyone can view services that have bookings" ON public.services;
DROP POLICY IF EXISTS "Anyone can view staff that have bookings" ON public.staff;

-- 3. Recreate policies using the functions (no recursion)
CREATE POLICY "Anyone can view locations that have bookings"
  ON public.locations FOR SELECT
  USING (id IN (SELECT public.get_location_ids_with_bookings()));

CREATE POLICY "Anyone can view services that have bookings"
  ON public.services FOR SELECT
  USING (id IN (SELECT public.get_service_ids_with_bookings()));

CREATE POLICY "Anyone can view staff that have bookings"
  ON public.staff FOR SELECT
  USING (id IN (SELECT public.get_staff_ids_with_bookings()));
