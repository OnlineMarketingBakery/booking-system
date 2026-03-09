-- Tables for forgot-password flow (used only by edge functions with service role)
-- 1. password_reset_tokens: after user requests reset, we store a token and send email with link
-- 2. pending_password_confirms: after user sets new password, we store hash + confirm token and send "click to confirm" email

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

CREATE TABLE IF NOT EXISTS public.pending_password_confirms (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON public.password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON public.password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_password_confirms_expires ON public.pending_password_confirms(expires_at);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_password_confirms ENABLE ROW LEVEL SECURITY;

-- No policies: only service role (edge functions) can read/write these tables
