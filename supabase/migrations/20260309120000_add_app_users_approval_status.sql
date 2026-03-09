-- Add approval status for sign-up flow: pending until admin approves, then user can log in
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';

-- Existing users are considered approved (all current rows get approved)
UPDATE public.app_users SET approval_status = 'approved';

-- Constrain allowed values
ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_approval_status_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_approval_status_check
  CHECK (approval_status IN ('pending', 'approved'));

COMMENT ON COLUMN public.app_users.approval_status IS 'pending = awaiting admin approval; approved = can sign in';
