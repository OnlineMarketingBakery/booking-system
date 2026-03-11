-- Revert to English-only backend: remove locale and restore 3-arg create_organization (run only if locale was previously added)
ALTER TABLE public.organizations DROP COLUMN IF EXISTS locale;

CREATE OR REPLACE FUNCTION public.insert_default_vat_rates_for_org(_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vat_rates (organization_id, name, percentage, is_default, percentage_disabled, sort_order)
  VALUES
    (_org_id, 'VAT high', 21, true, false, 0),
    (_org_id, 'VAT low', 9, false, false, 1),
    (_org_id, 'VAT free', 0, false, false, 2),
    (_org_id, 'VAT exempt', NULL, false, true, 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_insert_default_vat_rates_on_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.insert_default_vat_rates_for_org(NEW.id);
  RETURN NEW;
END;
$$;

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
