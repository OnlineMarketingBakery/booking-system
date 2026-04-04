-- One-time links for Plug&Pay (or similar) provisioned accounts to set their own password (Edge Functions + service role only).
CREATE TABLE IF NOT EXISTS public.purchase_account_setup_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_purchase_account_setup_tokens_token ON public.purchase_account_setup_tokens(token);
CREATE INDEX IF NOT EXISTS idx_purchase_account_setup_tokens_expires ON public.purchase_account_setup_tokens(expires_at);

ALTER TABLE public.purchase_account_setup_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (edge functions) can access
