-- Owner default assignee (visible as salon/owner, not "Unassigned"), multi-location for placeholder,
-- per-staff calendar prep (staff.user_id), and booking widget defaults.

-- 1) Staff can appear at multiple locations (placeholder must exist at every location).
ALTER TABLE public.staff_locations DROP CONSTRAINT IF EXISTS staff_locations_staff_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS staff_locations_staff_id_location_id_key
  ON public.staff_locations (staff_id, location_id);

-- 2) Mark built-in owner assignee rows
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS is_owner_placeholder boolean NOT NULL DEFAULT false;

UPDATE public.staff SET is_owner_placeholder = false WHERE is_owner_placeholder IS NULL;

-- 3) Organization → default staff used when no stylist is chosen / no active staff
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS owner_default_staff_id uuid;

-- FK after backfill
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_owner_default_staff_id_fkey'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_owner_default_staff_id_fkey
      FOREIGN KEY (owner_default_staff_id) REFERENCES public.staff (id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Backfill: one placeholder staff per org (if missing), link to all its locations
DO $$
DECLARE
  r record;
  sid uuid;
BEGIN
  FOR r IN
    SELECT o.id AS org_id, o.name AS org_name, o.owner_id
    FROM public.organizations o
    WHERE o.owner_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.organization_id = o.id AND COALESCE(s.is_owner_placeholder, false) = true
      )
  LOOP
    INSERT INTO public.staff (
      organization_id,
      name,
      phone,
      email,
      user_id,
      is_owner_placeholder,
      is_active
    )
    VALUES (
      r.org_id,
      r.org_name || ' (bookings)',
      NULL,
      NULL,
      r.owner_id,
      true,
      true
    )
    RETURNING id INTO sid;

    UPDATE public.organizations
    SET owner_default_staff_id = sid
    WHERE id = r.org_id;

    INSERT INTO public.staff_locations (staff_id, location_id)
    SELECT sid, l.id
    FROM public.locations l
    WHERE l.organization_id = r.org_id AND l.is_active = true
    ON CONFLICT (staff_id, location_id) DO NOTHING;
  END LOOP;
END $$;

-- Point org FK at existing placeholder if column was null
UPDATE public.organizations o
SET owner_default_staff_id = s.id
FROM public.staff s
WHERE s.organization_id = o.id
  AND COALESCE(s.is_owner_placeholder, false) = true
  AND o.owner_default_staff_id IS NULL;

-- 5) Link existing owner_default rows to any locations they might miss
INSERT INTO public.staff_locations (staff_id, location_id)
SELECT o.owner_default_staff_id, l.id
FROM public.organizations o
JOIN public.locations l ON l.organization_id = o.id AND l.is_active = true
WHERE o.owner_default_staff_id IS NOT NULL
ON CONFLICT (staff_id, location_id) DO NOTHING;

-- 6) New location → attach owner placeholder automatically
CREATE OR REPLACE FUNCTION public.link_owner_placeholder_to_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ph uuid;
BEGIN
  SELECT owner_default_staff_id INTO ph
  FROM public.organizations
  WHERE id = NEW.organization_id;

  IF ph IS NOT NULL THEN
    INSERT INTO public.staff_locations (staff_id, location_id)
    VALUES (ph, NEW.id)
    ON CONFLICT (staff_id, location_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_owner_placeholder_location ON public.locations;
CREATE TRIGGER trg_link_owner_placeholder_location
  AFTER INSERT ON public.locations
  FOR EACH ROW
  EXECUTE PROCEDURE public.link_owner_placeholder_to_location();

-- 7) create_organization_with_role: create placeholder immediately
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
  _staff_id UUID;
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

  INSERT INTO public.staff (
    organization_id,
    name,
    user_id,
    is_owner_placeholder,
    is_active
  )
  VALUES (
    _org_id,
    _name || ' (bookings)',
    _owner_id,
    true,
    true
  )
  RETURNING id INTO _staff_id;

  UPDATE public.organizations
  SET owner_default_staff_id = _staff_id
  WHERE id = _org_id;

  RETURN _org_id;
END;
$$;

-- 8) Public views
DROP VIEW IF EXISTS public.organizations_public;
CREATE VIEW public.organizations_public AS
  SELECT id, name, slug, logo_url, embed_theme, holiday_region, owner_default_staff_id
  FROM public.organizations;

GRANT SELECT ON public.organizations_public TO anon, authenticated;

DROP VIEW IF EXISTS public.staff_public;
CREATE VIEW public.staff_public AS
  SELECT id, name, organization_id, is_active, created_at, updated_at
  FROM public.staff
  WHERE COALESCE(is_owner_placeholder, false) = false;

GRANT SELECT ON public.staff_public TO anon, authenticated;

COMMENT ON COLUMN public.staff.is_owner_placeholder IS
  'True for the org owner default assignee row (not shown in public stylist list).';
COMMENT ON COLUMN public.organizations.owner_default_staff_id IS
  'Staff row used when the customer does not pick a stylist or the salon has no active stylists.';
