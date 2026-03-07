-- Fix 1: Recreate staff_public view WITHOUT security_invoker so anon can read it
-- The view itself only exposes safe columns (no email/phone), so this is secure by design
DROP VIEW IF EXISTS public.staff_public;
CREATE VIEW public.staff_public AS
  SELECT id, name, organization_id, is_active, created_at, updated_at
  FROM public.staff;

-- Fix 2: Create organizations_public view that hides sensitive fields
CREATE VIEW public.organizations_public AS
  SELECT id, name, slug, logo_url
  FROM public.organizations;

-- Restrict the overly permissive public SELECT on organizations
DROP POLICY "Public can view orgs by slug" ON public.organizations;

-- Authenticated org owners/staff already have access via existing policies
-- Add back public read ONLY for authenticated users who need full org data
CREATE POLICY "Authenticated users can view their orgs"
ON public.organizations FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR id IN (SELECT public.get_user_organization_ids(auth.uid()))
);