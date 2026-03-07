-- Create a public view that only exposes non-sensitive staff fields
CREATE VIEW public.staff_public
WITH (security_invoker = on) AS
  SELECT id, name, organization_id, is_active, created_at, updated_at
  FROM public.staff;

-- Drop the overly permissive public SELECT policy
DROP POLICY "Public can view active staff" ON public.staff;

-- Add a restrictive public SELECT policy: only allow reading via authenticated org context
-- Organization owners already have ALL access via existing policy
-- Staff can view themselves via existing policy
-- For public booking flow (anon), they must use staff_public view instead
CREATE POLICY "Authenticated users can view staff in their org"
ON public.staff FOR SELECT
TO authenticated
USING (
  organization_id IN (SELECT public.get_user_organization_ids(auth.uid()))
);