-- Point salon default assignee at the first real (non-placeholder) staff when one exists,
-- so "Org name (bookings)" is not the primary default when stylists are present.

UPDATE public.organizations o
SET owner_default_staff_id = pick.first_real_id
FROM (
  SELECT DISTINCT ON (s.organization_id) s.organization_id, s.id AS first_real_id
  FROM public.staff s
  WHERE s.is_active = true
    AND COALESCE(s.is_owner_placeholder, false) = false
  ORDER BY s.organization_id, s.created_at ASC
) pick
JOIN public.staff cur ON cur.id = o.owner_default_staff_id
  AND COALESCE(cur.is_owner_placeholder, false) = true
WHERE o.id = pick.organization_id;
