-- Configurable subscription plans (limits + metadata). Super admins edit; triggers and UI read.

CREATE TABLE public.plan_definitions (
  tier public.org_tier PRIMARY KEY,
  display_name text NOT NULL,
  max_locations integer NOT NULL CHECK (max_locations >= 1 AND max_locations <= 10000),
  description text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plan_definitions (tier, display_name, max_locations, description, features, sort_order)
VALUES
  (
    'tier_1',
    'Starter',
    1,
    'Single location. Booking widget and core scheduling.',
    '{"booking_widget": true, "public_booking": true, "multi_location": false}'::jsonb,
    1
  ),
  (
    'tier_2',
    'Growth',
    10,
    'Multiple locations for growing businesses.',
    '{"booking_widget": true, "public_booking": true, "multi_location": true}'::jsonb,
    2
  ),
  (
    'tier_3',
    'Enterprise',
    100,
    'High location cap for chains and franchises.',
    '{"booking_widget": true, "public_booking": true, "multi_location": true}'::jsonb,
    3
  );

CREATE TRIGGER update_plan_definitions_updated_at
  BEFORE UPDATE ON public.plan_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plan_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plan definitions readable"
  ON public.plan_definitions
  FOR SELECT
  USING (true);

CREATE POLICY "Super admins can update plan definitions"
  ON public.plan_definitions
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.plan_definitions TO anon, authenticated;

COMMENT ON TABLE public.plan_definitions IS
  'Per-tier limits and copy; max_locations drives location trigger. Edited by super admins only.';

-- Read caps from plan_definitions (fallback if row missing)
CREATE OR REPLACE FUNCTION public.org_max_locations(t public.org_tier)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT pd.max_locations FROM public.plan_definitions pd WHERE pd.tier = t LIMIT 1),
    CASE t
      WHEN 'tier_1'::public.org_tier THEN 1
      WHEN 'tier_2'::public.org_tier THEN 10
      WHEN 'tier_3'::public.org_tier THEN 100
      ELSE 1
    END
  );
$$;

COMMENT ON FUNCTION public.org_max_locations(public.org_tier) IS
  'Max active locations: plan_definitions.max_locations for tier, else legacy defaults.';

CREATE OR REPLACE FUNCTION public.enforce_location_tier_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_l int;
  active_count int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(NEW.is_active, true) THEN
      RETURN NEW;
    END IF;
    SELECT public.org_max_locations(o.tier) INTO max_l
    FROM public.organizations o
    WHERE o.id = NEW.organization_id;
    SELECT COUNT(*)::int INTO active_count
    FROM public.locations
    WHERE organization_id = NEW.organization_id
      AND is_active = true;
    IF active_count >= max_l THEN
      RAISE EXCEPTION 'Your plan allows at most % active location(s). Upgrade under Settings → Plan & limits.', max_l;
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_active, true) IS NOT DISTINCT FROM COALESCE(OLD.is_active, true)
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.is_active, true) THEN
    RETURN NEW;
  END IF;
  SELECT public.org_max_locations(o.tier) INTO max_l
  FROM public.organizations o
  WHERE o.id = NEW.organization_id;
  SELECT COUNT(*)::int INTO active_count
  FROM public.locations
  WHERE organization_id = NEW.organization_id
    AND is_active = true
    AND id IS DISTINCT FROM NEW.id;
  IF active_count >= max_l THEN
    RAISE EXCEPTION 'Your plan allows at most % active location(s). Upgrade under Settings → Plan & limits.', max_l;
  END IF;
  RETURN NEW;
END;
$$;
