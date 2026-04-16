-- New salons: no automatic "{name} (bookings)" staff row. First real staff (onboarding or Staff page)
-- sets organizations.owner_default_staff_id when it is still null or points at a placeholder.
-- Existing organizations and danger-zone recovery flows are unchanged.

CREATE OR REPLACE FUNCTION public.create_organization_with_role(
  _name TEXT,
  _slug TEXT,
  _owner_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _owner_id AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Super admins cannot own an organization. Use the Admin Panel to add salon owners.';
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES (_name, _slug, _owner_id)
  RETURNING id INTO _org_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_owner_id, 'salon_owner')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _org_id;
END;
$$;
