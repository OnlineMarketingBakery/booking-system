-- ============================================================
-- ONE-TIME: Delete all users (including super admin)
-- Run this in Supabase Dashboard → SQL Editor (as postgres / service role)
-- After running, sign up again in the app; the first user becomes super_admin.
-- ============================================================

-- Order: tables that reference user_id first, then user tables
DELETE FROM public.google_calendar_tokens;
DELETE FROM public.user_roles;
DELETE FROM public.profiles;
DELETE FROM public.app_users;
