
-- Table to store Google Calendar OAuth tokens for salon owners
CREATE TABLE public.google_calendar_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Only the owner can see/manage their own tokens
CREATE POLICY "Users can view own tokens"
  ON public.google_calendar_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tokens"
  ON public.google_calendar_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens"
  ON public.google_calendar_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
  ON public.google_calendar_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- Service role needs access from edge functions
CREATE POLICY "Service role full access"
  ON public.google_calendar_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- Timestamp trigger
CREATE TRIGGER update_google_calendar_tokens_updated_at
  BEFORE UPDATE ON public.google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
