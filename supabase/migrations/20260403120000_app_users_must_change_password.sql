-- Flag for accounts created with a one-time password (e.g. Plug&Pay provisioning).
ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_users.must_change_password IS 'When true, user should change password after first sign-in; cleared after successful in-app password change.';
