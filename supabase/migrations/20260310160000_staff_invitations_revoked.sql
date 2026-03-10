-- Allow 'revoked' status (owner removed/fired staff; that email cannot be added as staff again)
ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_status_check;
ALTER TABLE public.staff_invitations ADD CONSTRAINT staff_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'expired', 'rejected', 'revoked'));
