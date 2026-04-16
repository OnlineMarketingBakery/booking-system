-- Tier / location audit: actor_user_id FK targets auth.users. If JWT uid is missing from
-- auth.users (local seed, merged accounts, etc.), INSERT failed. Only set actor when present.

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
DECLARE
  v_actor uuid;
BEGIN
  SELECT au.id INTO v_actor FROM auth.users au WHERE au.id = auth.uid();

  INSERT INTO public.organization_audit_log (organization_id, actor_user_id, action, entity_type, entity_id, details)
  VALUES (
    p_organization_id,
    v_actor,
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
      || CASE
           WHEN v_actor IS NULL AND auth.uid() IS NOT NULL THEN jsonb_build_object('actor_uid_unresolved', true)
           ELSE '{}'::jsonb
         END
  );
END;
$$;

COMMENT ON FUNCTION public.log_organization_audit(uuid, text, text, uuid, jsonb) IS
  'Append audit row; actor_user_id only if auth.uid() exists in auth.users (else NULL + optional jwt_sub in details).';
