-- Staff can only be assigned to one location at a time.
-- Remove duplicate assignments (keep one per staff, earliest by id).
DELETE FROM public.staff_locations a
USING public.staff_locations b
WHERE a.staff_id = b.staff_id AND a.id > b.id;

-- Enforce at most one location per staff
ALTER TABLE public.staff_locations
  ADD CONSTRAINT staff_locations_staff_id_key UNIQUE (staff_id);
