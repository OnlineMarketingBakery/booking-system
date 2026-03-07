-- ============================================================
-- Add app_users table (required for custom auth / login)
-- Run this in Supabase SQL Editor if you already ran database-export.sql
-- and don't have the app_users table yet.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- Users can read their own record (auth.uid() will match via custom JWT)
DROP POLICY IF EXISTS "Users can view own record" ON public.app_users;
CREATE POLICY "Users can view own record" ON public.app_users
FOR SELECT USING (auth.uid() = id);

-- Users can update their own record
DROP POLICY IF EXISTS "Users can update own record" ON public.app_users;
CREATE POLICY "Users can update own record" ON public.app_users
FOR UPDATE USING (auth.uid() = id);

-- Service role bypass for edge functions (insert during signup)
DROP POLICY IF EXISTS "Service role full access" ON public.app_users;
CREATE POLICY "Service role full access" ON public.app_users
FOR ALL USING (auth.role() = 'service_role'::text);

-- Super admins can view all
DROP POLICY IF EXISTS "Super admins can view all app_users" ON public.app_users;
CREATE POLICY "Super admins can view all app_users" ON public.app_users
FOR SELECT USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_app_users_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
