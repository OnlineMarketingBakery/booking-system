-- Server-side location caps by organizations.tier + append-only audit log for tier & locations.

CREATE OR REPLACE FUNCTION public.org_max_locations(t public.org_tier)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE t
    WHEN 'tier_1'::public.org_tier THEN 1
    WHEN 'tier_2'::public.org_tier THEN 10
    WHEN 'tier_3'::public.org_tier THEN 100
    ELSE 1
  END;
$$;

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
      RAISE EXCEPTION 'Your plan allows at most % active location(s). Upgrade under Plan & limits in the dashboard.', max_l;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
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
    RAISE EXCEPTION 'Your plan allows at most % active location(s). Upgrade under Plan & limits in the dashboard.', max_l;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_location_tier_limit ON public.locations;
CREATE TRIGGER trg_enforce_location_tier_limit
  BEFORE INSERT OR UPDATE OF is_active, organization_id ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_location_tier_limit();

COMMENT ON FUNCTION public.org_max_locations(public.org_tier) IS
  'Max active locations per subscription tier; kept in sync with dashboard TIER_LIMITS.';

-- Audit log (append-only via triggers; no client INSERT policy)
CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_audit_log_org_created_idx
  ON public.organization_audit_log (organization_id, created_at DESC);

ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org owners can view their audit log"
  ON public.organization_audit_log
  FOR SELECT
  USING (
    organization_id IN (
      SELECT id FROM public.organizations WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Super admins can view all audit logs"
  ON public.organization_audit_log
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.log_organization_audit(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_audit_log (organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, COALESCE(p_details, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_organization_tier_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tier IS DISTINCT FROM OLD.tier) THEN
    PERFORM public.log_organization_audit(
      NEW.id,
      'tier_changed',
      'organization',
      NEW.id,
      jsonb_build_object('from', OLD.tier::text, 'to', NEW.tier::text)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_organization_tier ON public.organizations;
CREATE TRIGGER trg_audit_organization_tier
  AFTER UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_organization_tier_change();

CREATE OR REPLACE FUNCTION public.audit_location_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_organization_audit(
      NEW.organization_id,
      'location_created',
      'location',
      NEW.id,
      jsonb_build_object('name', NEW.name, 'is_active', NEW.is_active)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.name IS NOT DISTINCT FROM NEW.name
       AND OLD.address IS NOT DISTINCT FROM NEW.address
       AND OLD.phone IS NOT DISTINCT FROM NEW.phone
       AND OLD.is_active IS NOT DISTINCT FROM NEW.is_active
       AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN
      RETURN NEW;
    END IF;
    PERFORM public.log_organization_audit(
      NEW.organization_id,
      'location_updated',
      'location',
      NEW.id,
      jsonb_build_object(
        'before', jsonb_build_object(
          'name', OLD.name, 'address', OLD.address, 'phone', OLD.phone, 'is_active', OLD.is_active
        ),
        'after', jsonb_build_object(
          'name', NEW.name, 'address', NEW.address, 'phone', NEW.phone, 'is_active', NEW.is_active
        )
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_location_row_ins ON public.locations;
CREATE TRIGGER trg_audit_location_row_ins
  AFTER INSERT ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_location_row();

DROP TRIGGER IF EXISTS trg_audit_location_row_upd ON public.locations;
CREATE TRIGGER trg_audit_location_row_upd
  AFTER UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_location_row();

COMMENT ON TABLE public.organization_audit_log IS
  'Owner-visible audit trail for tier and location changes; written by triggers only.';

GRANT SELECT ON public.organization_audit_log TO authenticated;
