
-- Custom auth users table
CREATE TABLE public.app_users (
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
CREATE POLICY "Users can view own record" ON public.app_users
FOR SELECT USING (auth.uid() = id);

-- Users can update their own record
CREATE POLICY "Users can update own record" ON public.app_users
FOR UPDATE USING (auth.uid() = id);

-- Service role bypass for edge functions (insert during signup)
CREATE POLICY "Service role full access" ON public.app_users
FOR ALL USING (auth.role() = 'service_role'::text);

-- Super admins can view all
CREATE POLICY "Super admins can view all app_users" ON public.app_users
FOR SELECT USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_app_users_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
