-- Drop the FK constraint on user_roles that references auth.users
-- so it can work with app_users IDs from the custom auth system
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;