-- Drop FK on organizations.owner_id that references auth.users
-- Custom auth uses app_users table instead
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_owner_id_fkey;

-- Also drop any remaining auth.users FKs on profiles and staff
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_user_id_fkey;