-- Add currency column to services table
ALTER TABLE public.services 
ADD COLUMN currency text NOT NULL DEFAULT 'usd';

-- Add a comment for documentation
COMMENT ON COLUMN public.services.currency IS 'ISO 4217 currency code, e.g. usd, eur, gbp';