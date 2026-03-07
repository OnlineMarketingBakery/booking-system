-- Create a transactional function for organization + role creation
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
  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES (_name, _slug, _owner_id)
  RETURNING id INTO _org_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_owner_id, 'salon_owner')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _org_id;
END;
$$;