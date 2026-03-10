-- Rate limit: one password reset request per user per 24 hours (used only by edge functions)
CREATE TABLE IF NOT EXISTS public.password_reset_rate_limit (
  user_id UUID PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  last_requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.password_reset_rate_limit ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (edge functions) can read/write
