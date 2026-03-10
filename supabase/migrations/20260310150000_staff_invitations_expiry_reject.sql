-- Add expiry and reject support to staff_invitations
ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- Set default expiry for new rows (7 days) - backfill existing
UPDATE public.staff_invitations
SET expires_at = invited_at + INTERVAL '7 days'
WHERE expires_at IS NULL;

ALTER TABLE public.staff_invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '7 days');

-- Allow 'rejected' status
ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_status_check;
ALTER TABLE public.staff_invitations ADD CONSTRAINT staff_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'expired', 'rejected'));
